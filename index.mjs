import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

import AssistantV2 from "ibm-watson/assistant/v2.js";
import { IamAuthenticator } from "ibm-watson/auth/index.js";

const app = express();
app.use(express.json());
app.use(cors());

const assistant = new AssistantV2({
  version: "2021-11-27",
  authenticator: new IamAuthenticator({
    apikey: process.env.WATSON_ASSISTANT_APIKEY,
  }),
  serviceUrl: process.env.WATSON_ASSISTANT_URL,
});

const assistantId = process.env.WATSON_ASSISTANT_ID;
let sessionId;

app.get("/api/session", async (_, res) => {
  try {
    const session = await assistant.createSession({
      assistantId: assistantId,
    });
    sessionId = session.result.session_id;
    res.json({ sessionId });
    console.log("Session created successfully:", sessionId);
  } catch (err) {
    console.error("Error creating session:", err);
    res.status(500).send("Error creating session");
  }
});

app.post("/api/message", async (req, res) => {
  const { message } = req.body;

  if (!sessionId) {
    return res
      .status(400)
      .json({ error: "Session not started. Please call /api/session first." });
  }

  try {
    const response = await assistant.message({
      assistantId: assistantId,
      sessionId: sessionId,
      environmentId: process.env.WATSON_ASSISTANT_ID,
      input: {
        message_type: "text",
        text: message,
      },
    });

    console.log(
      "Full response from Watson:",
      JSON.stringify(response.result, null, 2)
    );

    res.json(response.result.output);
  } catch (err) {
    console.error("Error sending message to Watson:", err);
    res.status(500).send("Error communicating with Watson Assistant");
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
