// Return the actual matched prefix length so spacing never shifts the body.
export function activationLength(text, activation = '小婕 GTD') {
  if (typeof text !== 'string') return 0;
  const escape = word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = activation.trim().split(/\s+/u).map(escape).join('\\s*');
  return text.match(new RegExp('^\\s*' + pattern + '(?=$|[\\s，,:：])', 'iu'))?.[0].length ?? 0;
}
