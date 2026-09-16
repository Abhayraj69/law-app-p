/**
 * Zod request validation middleware.
 *
 * Mirrors copilotController.js's validateToolInput (the app's one existing
 * zod-validated surface): safeParse against a schema, and on failure return
 * the same 400 shape the rest of the app already uses for validation
 * errors — `{ success: false, error: 'Validation failed: <field>: <msg>; ...' }`.
 * On success, req.body/req.query is replaced with the parsed (and
 * coerced/defaulted) data, same as validateToolInput does.
 */

function formatZodError(error) {
  return error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
}

function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ success: false, error: `Validation failed: ${formatZodError(result.error)}` });
    }
    req.body = result.data;
    next();
  };
}

function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json({ success: false, error: `Validation failed: ${formatZodError(result.error)}` });
    }
    req.query = result.data;
    next();
  };
}

module.exports = { validateBody, validateQuery };
