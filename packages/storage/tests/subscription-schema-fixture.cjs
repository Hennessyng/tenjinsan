function strictSchema(value) {
  if (Array.isArray(value)) return value.every(strictSchema)
  if (!value || typeof value !== "object") return true
  if (
    value.properties &&
    (value.additionalProperties !== false ||
      Object.keys(value.properties).some((key) => !value.required?.includes(key)))
  )
    return false
  return Object.values(value).every(strictSchema)
}
function schemaRoot(schema) {
  let current = schema
  const seen = new Set()
  while (typeof current?.$ref === "string") {
    const ref = current.$ref
    if (!ref.startsWith("#/") || seen.has(ref))
      throw new Error("Unsupported fixture schema reference")
    seen.add(ref)
    current = ref
      .slice(2)
      .split("/")
      .reduce((value, key) => value?.[key.replace(/~1/g, "/").replace(/~0/g, "~")], schema)
  }
  return current
}
module.exports = { strictSchema, schemaRoot }
