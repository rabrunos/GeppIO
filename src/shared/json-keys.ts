/** Call only after JSON.parse accepts the bounded text. JSON.parse alone keeps the last occurrence. */
export function assertUniqueJsonKeys(text: string): void {
  const fields: Set<string>[] = []
  for (const token of text.matchAll(/"(?:[^"\\]|\\[\s\S])*"|[{}]/g)) {
    if (token[0] === '{') fields.push(new Set())
    else if (token[0] === '}') fields.pop()
    else if (/^\s*:/.test(text.slice(token.index! + token[0].length))) {
      const key = JSON.parse(token[0]) as string, object = fields.at(-1)!
      if (object.has(key)) throw new Error('Campo JSON duplicado.')
      object.add(key)
    }
  }
}
