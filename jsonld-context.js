import { AUTOMATIC_SUBMISSION_JSON_LD_CONTEXT_ENDPOINT } from './env';

async function getContext() {
  return AUTOMATIC_SUBMISSION_JSON_LD_CONTEXT_ENDPOINT;
}

export { getContext };
