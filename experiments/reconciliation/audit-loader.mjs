// Optional import redirection only. Original test bytes and assertions stay unchanged.
// NODE_OPTIONS propagates the same frozen/fixed source choice to child workers.
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
const original = '/Users/ross/.gemini/antigravity/scratch/rightclick-x/';
const target = process.env.RCX_AUDIT_TARGET;
if (target) registerHooks({resolve(specifier, context, next) {
  const prefix = specifier.startsWith('file:') ? pathToFileURL(original).href : original;
  return next(specifier.startsWith(prefix) ? pathToFileURL(target + '/' + specifier.slice(prefix.length)).href : specifier, context);
}});
