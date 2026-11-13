/** Binding inspectors visit the original executable IR, including a prepared
 * Noise field's original kernel. Embedded image pixels are numeric data: the
 * image builder and cooperative preparation validate that payload separately.
 * Keep all other fields visible so this optimization cannot hide UV/owner/
 * geometry dependencies in the image's vector or surrounding expressions. */
export function irInspectionChildren(value: object): unknown[] {
  const record = value as Record<string, unknown>
  if (record.op === 'tex_image')
    return Object.keys(record).filter(key => key !== 'pixels').map(key => record[key])
  return Object.values(record)
}
