const path = require("node:path");
const { handleChatRequest, loadDotEnv } = require("../lib/chat");

loadDotEnv(path.join(__dirname, ".."));

module.exports = async function handler(req, res) {
  await handleChatRequest(req, res);
};
