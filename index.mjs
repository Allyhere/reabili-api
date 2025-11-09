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
        userId: user.ID_USER,
        username: user.NM_USER,
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

app.get("/article", async (req, res) => {
  let connection;

  try {
    connection = await oracledb.getConnection(dbConfig);
    const sql = `
      SELECT 
        a.ID_ARTICLE, 
        a.NM_ARTICLE, 
        a.T_CCG_USER_ID_USER,
        r.ID_RELATED,
        r.DS_TYPE,
        r.DS_URL,
        r.DS_CONTENT
      FROM 
        T_CCG_ARTICLE a
      LEFT JOIN 
        T_CCG_RELATED r ON a.ID_ARTICLE = r.T_CCG_ARTICLE_ID_ARTICLE
      ORDER BY
        a.ID_ARTICLE
    `;

    const result = await connection.execute(sql);

    const articlesMap = new Map();

    for (const row of result.rows) {
      const articleId = row.ID_ARTICLE;

      if (!articlesMap.has(articleId)) {
        articlesMap.set(articleId, {
          id: articleId.toString(),
          name: row.NM_ARTICLE,
          userId: row.T_CCG_USER_ID_USER,
          related: [],
        });
      }

      if (row.ID_RELATED) {
        const article = articlesMap.get(articleId);

        article.related.push({
          type: row.DS_TYPE,
          url: row.DS_URL,
          description: row.NM_ARTICLE,
          content: row.DS_CONTENT,
        });
      }
    }

    const allArticles = Array.from(articlesMap.values());

    res.json(allArticles);
  } catch (err) {
    console.error("Error retrieving articles:", err);
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

app.get("/article/:id", async (req, res) => {
  const { id } = req.params;
  let connection;

  if (!id) {
    return res.status(400).json({ message: "Article ID is required." });
  }

  try {
    connection = await oracledb.getConnection(dbConfig);

    const sql = `
      SELECT 
        a.ID_ARTICLE, 
        a.NM_ARTICLE, 
        a.T_CCG_USER_ID_USER,
        r.ID_RELATED,
        r.DS_TYPE,
        r.DS_URL,
        r.DS_CONTENT
      FROM 
        T_CCG_ARTICLE a
      LEFT JOIN 
        T_CCG_RELATED r ON a.ID_ARTICLE = r.T_CCG_ARTICLE_ID_ARTICLE
      WHERE 
        a.ID_ARTICLE = :id
    `;

    const result = await connection.execute(sql, { id });

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Artigo não encontrado" });
    }

    const firstRow = result.rows[0];
    const article = {
      id: firstRow.ID_ARTICLE.toString(),
      name: firstRow.NM_ARTICLE,
      userId: firstRow.T_CCG_USER_ID_USER,
      related: [],
    };

    for (const row of result.rows) {
      if (row.ID_RELATED) {
        article.related.push({
          type: row.DS_TYPE,
          url: row.DS_URL,
          description: row.NM_ARTICLE,
          content: row.DS_CONTENT,
        });
      }
    }

    res.json(article);
  } catch (err) {
    console.error(`Error retrieving article ${id}:`, err);
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

app.post("/article", async (req, res) => {
  const { name, userId, related } = req.body;
  let connection;

  if (!name || !userId || !Array.isArray(related)) {
    return res.status(400).json({
      message:
        "Invalid payload. 'name', 'userId', and 'related' (array) are required.",
    });
  }

  try {
    connection = await oracledb.getConnection(dbConfig);
    connection.autocommit = false;

    const articleSql = `
      INSERT INTO T_CCG_ARTICLE (ID_ARTICLE, NM_ARTICLE, T_CCG_USER_ID_USER)
      VALUES (YOUR_ARTICLE_SEQUENCE.NEXTVAL, :name, :userId)
      RETURNING ID_ARTICLE INTO :outId
    `;

    const articleBindBinds = {
      name,
      userId,
      outId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
    };

    const articleResult = await connection.execute(
      articleSql,
      articleBindBinds
    );
    const newArticleId = articleResult.outBinds.outId[0];

    if (related.length > 0) {
      const relatedSql = `
        INSERT INTO T_CCG_RELATED (
          DS_TYPE, 
          DS_URL, 
          DS_CONTENT, 
          T_CCG_ARTICLE_ID_ARTICLE, 
          ID_USER
        )
        VALUES (
          :type, 
          :url, 
          :content, 
          :articleId, 
          :userId
        )
      `;

      const relatedData = related.map((item) => ({
        type: item.type,
        url: item.url || "",
        content: item.content || "",
        articleId: newArticleId,
        userId: userId,
      }));

      await connection.executeMany(relatedSql, relatedData, {
        autoCommit: false,
      });
    }

    await connection.commit();

    const createdArticle = {
      id: newArticleId.toString(),
      name: name,
      userId: userId,
      related: related.map((item) => ({
        type: item.type,
        url: item.url || "",
        description: name,
        content: item.content || "",
      })),
    };

    res.status(201).json(createdArticle);
  } catch (err) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollErr) {
        console.error("Error during rollback:", rollErr);
      }
    }
    console.error("Error creating article:", err);
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

app.delete("/article/:id", async (req, res) => {
  const { id } = req.params;
  let connection;

  if (!id) {
    return res.status(400).json({ message: "Article ID is required." });
  }

  try {
    connection = await oracledb.getConnection(dbConfig);
    connection.autocommit = false;

    const relatedSql = `
      DELETE FROM T_CCG_RELATED
      WHERE T_CCG_ARTICLE_ID_ARTICLE = :id
    `;
    await connection.execute(relatedSql, { id });

    const articleSql = `
      DELETE FROM T_CCG_ARTICLE
      WHERE ID_ARTICLE = :id
    `;
    const result = await connection.execute(articleSql, { id });

    if (result.rowsAffected === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Artigo não encontrado" });
    }

    await connection.commit();

    res.status(200).json({ message: "Artigo deletado com sucesso" });
  } catch (err) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollErr) {
        console.error("Error during rollback:", rollErr);
      }
    }
    console.error(`Error deleting article ${id}:`, err);
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

app.get("/user/:id", async (req, res) => {
  const { id } = req.params;
  let connection;

  if (!id) {
    return res.status(400).json({ message: "User ID is required." });
  }

  try {
    connection = await oracledb.getConnection(dbConfig);

    const sql = `
      SELECT 
        u.ID_USER,
        u.DS_USERNAME,
        u.NM_USER,
        a.ID_ARTICLE,
        a.NM_ARTICLE
      FROM 
        T_CCG_USER u
      LEFT JOIN 
        T_CCG_ARTICLE a ON u.ID_USER = a.T_CCG_USER_ID_USER
      WHERE
        u.ID_USER = :id
      ORDER BY
        a.NM_ARTICLE
    `;

    const result = await connection.execute(sql, { id });

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }

    const firstRow = result.rows[0];
    const userResponse = {
      userId: firstRow.ID_USER,
      username: firstRow.NM_USER,
      usernameId: firstRow.DS_USERNAME,
      articles: [],
    };

    for (const row of result.rows) {
      if (row.ID_ARTICLE) {
        userResponse.articles.push({
          articleId: row.ID_ARTICLE,
          name: row.NM_ARTICLE,
        });
      }
    }

    res.json(userResponse);
  } catch (err) {
    console.error(`Error retrieving user ${id}:`, err);
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

app.put("/user/:id", async (req, res) => {
  const { id } = req.params;
  const { username, name, token } = req.body;
  let connection;

  const updateFields = [];
  // Usamos um objeto para os binds, mas com 'bindData.id = id'
  // é mais seguro usar um array para os binds na query
  // e garantir a ordem, ou usar um objeto de forma consistente.
  // Vamos manter seu estilo com objeto, pois é mais claro.
  const bindData = {};

  if (username !== undefined) {
    updateFields.push("DS_USERNAME = :username");
    bindData.username = username;
  }
  if (name !== undefined) {
    updateFields.push("NM_USER = :name");
    bindData.name = name;
  }
  if (token !== undefined) {
    updateFields.push("DS_TOKEN = :token");
    bindData.token = token;
  }

  if (updateFields.length === 0) {
    return res.status(400).json({
      message:
        "Nenhum campo para atualizar foi fornecido (username, name, token).",
    });
  }

  const numericId = Number(id);
  if (isNaN(numericId)) {
    return res
      .status(400)
      .json({ message: "ID de usuário inválido. Deve ser um número." });
  }
  bindData.id = numericId;

  const sql = `
    UPDATE T_CCG_USER
    SET ${updateFields.join(", ")}
    WHERE ID_USER = :id
  `;

  try {
    connection = await oracledb.getConnection(dbConfig);

    const result = await connection.execute(sql, bindData);

    if (result.rowsAffected === 0) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }

    await connection.commit();

    res.status(200).json({ message: "Usuário atualizado com sucesso" });
  } catch (err) {
    console.error(`Error updating user ${id}:`, err);
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
