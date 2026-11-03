/**
 * Operators are the people who run this SaaS (you), not its customers. In development everyone is one; in
 * production only the emails in OPERATOR_EMAILS (comma separated) or users whose metadata role is "admin".
 */
function isOperator(user) {
  if (process.env.NODE_ENV !== 'production') return true;
  const allow = String(process.env.OPERATOR_EMAILS || '')
    .toLowerCase()
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  return allow.includes(String(user?.email || '').toLowerCase()) || user?.user_metadata?.role === 'admin';
}

module.exports = { isOperator };
