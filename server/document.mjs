import '../public/wordflow-model.js';
import {ApiError} from './telegram.mjs';
const model=globalThis.WordflowModel;
export const MAX_DOCUMENT_BYTES=model.MAX_DOCUMENT_BYTES;
export const BUILTIN_WORDS=model.BUILTIN_WORDS;

export function validateDocument(input,now=Date.now()) {
  try {return model.validateDocument(input,now);}
  catch(error) {
    if(error.code==='too_large') throw new ApiError(413,'too_large','Словари слишком большие. Сохраните копию и уменьшите количество словарей.');
    throw new ApiError(400,'invalid_document','Не удалось сохранить данные. Сохраните копию словарей и попробуйте ещё раз.');
  }
}
