const path = require("path");
const express = require("express");
const { handleAction } = require("./lib/roomService");

const app = express();

const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/room", async (req, res) => {
  try {
    const result = await handleAction({
      action: "state",
      payload: {
        roomId: req.query.roomId,
        userId: req.query.userId,
      },
    });
    res.json({ ok: true, data: result });
  } catch (error) {
    // Keep HTTP 200 for expected business errors to avoid noisy browser network failures.
    res.json({ ok: false, error: error.message || "Unknown error" });
  }
});

app.post("/api/room", async (req, res) => {
  try {
    const action = req.body && req.body.action;
    const payload = (req.body && req.body.payload) || {};
    const result = await handleAction({ action, payload });
    res.json({ ok: true, data: result });
  } catch (error) {
    // Keep HTTP 200 for expected business errors to avoid noisy browser network failures.
    res.json({ ok: false, error: error.message || "Unknown error" });
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Plugd companion app running on http://localhost:${PORT}`);
});
