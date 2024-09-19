import { OpenAI } from 'openai';
const openai = new OpenAI();

interface Action {
  filename: string;
  path: string;
}
export interface UpsertFile extends Action {
  action: 'upsert';
  content: string;
}
export interface AddFile extends Action {
  action: 'add';
  content: string;
}

export interface DeleteFile extends Action {
  action: 'delete';
}

export async function patchVectorStore(
  vectorStoreId: string,
  files: (AddFile | UpsertFile | DeleteFile)[],
) {
  await deleteVectoreStoreFiles(
    vectorStoreId,
    files.filter((file) => file.action !== 'add').map((file) => file.filename),
  );
  await openai.beta.vectorStores.fileBatches.uploadAndPoll(vectorStoreId, {
    files: files
      .filter((file) => file.action !== 'delete')
      .map((file) => new File([file.content], file.filename)),
  });
}

export async function deleteVectoreStoreFiles(
  vectorStoreId: string,
  files: string[],
) {
  let vectorStoreFiles = await openai.beta.vectorStores.files.list(
    vectorStoreId,
    { limit: 100 },
  );
  const deleteFiles = files.slice(0);
  while (deleteFiles.length) {
    for (let i = 0; i < deleteFiles.length; i++) {
      const file = deleteFiles[i];
      // FIXME: this won't work. we need to save the file id in some database
      // and then retrieve the id from it.
      const foundfiles = vectorStoreFiles.data.filter((f) => f.id === file);
      if (foundfiles.length) {
        deleteFiles.splice(i, 1);
        i--;
        for (const file of foundfiles) {
          await openai.beta.vectorStores.files.del(vectorStoreId, file.id);
        }
      }
    }
    if (!vectorStoreFiles.nextPageInfo()) {
      // no more pages. Some files might not have been deleted, there might be new files.
      break;
    }
    vectorStoreFiles = await vectorStoreFiles.getNextPage();
  }
}
