function isSuperAdminRequest(req) {
  return (
    (req.session && req.session.permission === "111") ||
    (req.isLongTermToken === true && req.tokenUserPermission === "111")
  );
}
module.exports = { isSuperAdminRequest };
