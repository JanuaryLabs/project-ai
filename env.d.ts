declare global {
  namespace NodeJS {
    interface ProcessEnv {
      OPENAI_API_KEY: string;
      OPENAI_VECTOR_STORE_ID: string;
      OPENAI_ASSISTANT_ID: string;
    }
  }
}

export {};
