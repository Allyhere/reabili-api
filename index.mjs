import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import oracledb from "oracledb";

dotenv.config();
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.autoCommit = true;

import AssistantV2 from "ibm-watson/assistant/v2.js";
import { IamAuthenticator } from "ibm-watson/auth/index.js";

const app = express();
app.use(express.json());
app.use(cors());

/* Watson Assistant setup and routes for /api/session and /api/message */

const assistant = new AssistantV2({
  version: "2021-11-27",
  authenticator: new IamAuthenticator({
    apikey: process.env.WATSON_ASSISTANT_APIKEY,
  }),
  serviceUrl: process.env.WATSON_ASSISTANT_URL,
});

const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  connectString: `${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_SERVICE}`,
};

const assistantId = process.env.WATSON_ASSISTANT_ID;
let sessionId;

async function initialize() {
  try {
    await oracledb.createPool(dbConfig);
    console.log("OracleDB connection pool created successfully.");
  } catch (err) {
    console.error("Error creating OracleDB connection pool:", err);
    process.exit(1);
  }
}

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

/* REST API */

app.post("/login", async (req, res) => {
  const { username, token } = req.body;
  let connection;

  console.log({ username, token });
  if (!username || !token) {
    return res
      .status(400)
      .json({ success: false, message: "username and token are required." });
  }

  try {
    connection = await oracledb.getConnection(dbConfig);

    const result = await connection.execute(
      `SELECT id_user, DS_username, NM_user 
       FROM T_CCG_USER 
       WHERE DS_username = :username AND ds_token = :token`,
      { username, token }
    );

    if (result.rows.length > 0) {
      const user = result.rows[0];

      res.json({
        message: "Login bem-sucedido",
        id_user: user.ID_USER,
        ds_username: user.NM_USER,
      });
    } else {
      res
        .status(401)
        .json({ message: "Combinação de usuário e token inválida" });
    }
  } catch (err) {
    console.error("Error during login:", err);
    res.status(500).send("Erro de servidor");
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error("Error closing connection:", err);
      }
    }
  }
});

const port = process.env.PORT || 3001;
initialize().then(() => {
  app.listen(port, () => {
    console.log(`Server listening at ${port}`);
  });
});
