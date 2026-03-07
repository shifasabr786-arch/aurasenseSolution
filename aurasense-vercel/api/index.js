/**
 * VERCEL Serverless Function (Node.js)
 *
 * Receives data from ESP32 -> calls Render API -> writes prediction to Firestore.
 */

const axios = require("axios");

// Your hosted prediction API
const RENDER_API_ENDPOINT = "https://aurasense-api.onrender.com/predict";

// Ensure these are set in Vercel Environment Variables
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;

/**
 * Write fields to Firestore document: user_display/{userId}/readings/latest
 */
async function writeToFirestore(userId, data) {
  const docPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/user_display/${userId}/readings/latest`;

  const fields = {
    stress_level: { stringValue: data.stress_level },
    hr: { doubleValue: data.hr },
    timestamp: { timestampValue: new Date().toISOString() },
  };

  if (data.probabilities) {
    const probFields = {};
    for (const key in data.probabilities) {
      probFields[key] = { doubleValue: data.probabilities[key] };
    }
    fields.probabilities = { mapValue: { fields: probFields } };
  }

  try {
    // PATCH — original behavior (updates existing doc)
    await axios.patch(
      `https://firestore.googleapis.com/v1/${docPath}?key=${FIREBASE_API_KEY}`,
      { fields }
    );
    console.log(`[Vercel] Wrote to Firestore for user ${userId}`);
  } catch (err) {
    console.error("[Vercel] Firestore write error:", err.response ? err.response.data : err.message);
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).send("Method Not Allowed");
  }

  const { hr, hrv, bt, userId } = req.body;

  if (!hr || !userId) {
    return res.status(400).send({ error: "Missing required fields: hr, userId" });
  }

  console.log(`[Vercel] Received data for user ${userId}:`, req.body);

  const apiPayload = {
    mode: "raw",
    raw: {
      HR: hr,
      HRV: hrv,
      BT: bt,
    },
  };

  try {
    const apiResponse = await axios.post(RENDER_API_ENDPOINT, apiPayload);

    if (apiResponse.data && apiResponse.data.stress_level) {
      const prediction = apiResponse.data.stress_level;
      const probabilities = apiResponse.data.probabilities || null;

      console.log(`[Vercel] API Prediction: ${prediction}`);

      // write to Firestore
      await writeToFirestore(userId, {
        stress_level: prediction,
        probabilities,
        hr,
      });

      return res.status(200).send({ success: true, prediction });
    } else {
      console.error("[Vercel] Unexpected API response:", apiResponse.data);
      return res.status(500).send({ error: "Bad API response" });
    }
  } catch (err) {
    console.error("[Vercel] Error calling prediction API:", err.message);
    if (err.response) console.error("API error data:", err.response.data);
    return res.status(500).send({ error: "API call failed" });
  }
};
