const { handleAction } = require("../lib/roomService");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  try {
    if (req.method === "GET") {
      const result = await handleAction({
        action: "state",
        payload: {
          roomId: req.query.roomId,
          userId: req.query.userId,
        },
      });
      res.status(200).json({ ok: true, data: result });
      return;
    }

    if (req.method === "POST") {
      const action = req.body && req.body.action;
      const payload = (req.body && req.body.payload) || {};
      const result = await handleAction({ action, payload });
      res.status(200).json({ ok: true, data: result });
      return;
    }

    res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || "Unknown error" });
  }
};
