// British IPA from open-dict-data/ipa-dict, embedded with its MIT license.
// Exact entries only: never guess a pronunciation for an unknown word.
const transcriptionCache = new Map();
function transcriptionFor(text) {
  const key = text.trim().toLocaleLowerCase('en').replace(/’/g, "'");
  if (!key || /[\r\n\t]/.test(key)) return '';
  if (transcriptionCache.has(key)) return transcriptionCache.get(key);
  const marker = `\n${key}\t`, index = IPA_WORDLIST.indexOf(marker);
  const start = index + marker.length;
  const ipa = index < 0 ? '' : IPA_WORDLIST.slice(start, IPA_WORDLIST.indexOf('\n', start)).trim();
  transcriptionCache.set(key, ipa);
  return ipa;
}
