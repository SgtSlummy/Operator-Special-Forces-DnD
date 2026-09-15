/** A missing expected code is never permission to accept an unexpected controller failure. */
export function classifyRehearsalError(error,expectedCode){
 return typeof expectedCode==='string'&&expectedCode.length>0&&error?.code===expectedCode?'EXPECTED_REJECTION':'FAIL';
}
