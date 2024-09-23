import {
  feature,
  field,
  policy,
  project,
  table,
  trigger,
  unique,
  ValidationDefinition,
  workflow,
} from '@january/declarative';

import {
  createQueryBuilder,
  execute,
  removeEntity,
  saveEntity,
  upsertEntity,
} from '@extensions/postgresql';
import {
  openai,
  processPushEvent,
  toActionableFiles,
  vectorStore,
} from '@extensions/user';
import { tables } from 'src/features/entities';

function validate<T>(
  value: T,
  ...validators: ValidationDefinition[] | ValidationDefinition[][]
) {
  return {
    value,
    validators,
  };
}
// const uid = validate(trigger.body.uid, mandatory(), str({ allowEmpty: false }));
// ajv
// schema: {
//   uid: {
//     mapper: (trigger) => trigger.body,
//     validation: [mandatory(), str()],
//     type: 'string',
//     required: true,
//   },
//   uid: [trigger.body, mandatory(), str()],
// },

function str(
  options: {
    allowEmpty?: boolean;
    trim?: boolean;
  } = {},
): ValidationDefinition {
  return {
    name: 'string',
    details: options,
  };
}
export default project(
  feature('ai', {
    policies: {
      merged: policy.github({
        events: ['pull_request.closed'],
        guard: (event) => event.payload.pull_request.merged,
      }),
      mainBranch: policy.github({
        events: ['push'],
        guard: (event) => event.payload.ref === 'refs/heads/main',
      }),
    },
    tables: {
      threads: table({
        fields: {
          id: field.primary({
            type: 'string',
            generated: false,
          }),
        },
      }),
      files: table({
        fields: {
          id: field.primary({
            type: 'string',
            generated: false,
          }),
          name: field.shortText({
            validations: [unique()],
          }),
        },
      }),
    },
    workflows: [
      workflow('AskStream', {
        tag: 'ask',
        trigger: trigger.sse({
          path: '/',
        }),
        execute: async (trigger) => {
          await openai.beta.threads.messages.create(trigger.body.threadId, {
            role: 'user',
            content: `${trigger.body.message}\nImplicit details: feature, workflow, actions, tables, fields, extensions.`,
          });
          const run = openai.beta.threads.runs.stream(trigger.body.threadId, {
            assistant_id: process.env.OPENAI_ASSISTANT_ID,
          });
          return run.toReadableStream();
        },
      }),
      workflow('CreateThread', {
        tag: 'threads',
        trigger: trigger.http({
          path: '/',
          method: 'post',
        }),
        execute: async (trigger) => {
          const threadId = await openai.beta.threads
            .create()
            .then((res) => res.id);

          await saveEntity(tables.threads, { id: threadId });

          return {
            threadId,
          };
        },
      }),
      workflow('AskAiWorkflow', {
        tag: 'ask',
        trigger: trigger.http({
          path: '/',
          method: 'post',
        }),
        execute: async (trigger) => {
          return {
            test: trigger,
          };
        },
      }),
      workflow('UpsertDocFromPushRequestWorkflow', {
        tag: 'docs',
        trigger: trigger.github({
          policies: ['mainBranch'],
          event: 'push',
          // mapper: (trigger) => ({
          //   before: validate(
          //     trigger.payload.before,
          //     mandatory(),
          //     str({ allowEmpty: false }),
          //   ),
          //   after: {
          //     mapper: trigger.payload.after,
          //     validation: [mandatory(), str()],
          //     type: 'string',
          //     required: true,
          //   },
          //   ref: v.string({
          //   }),
          //   orgRepo: trigger.payload.repository.full_name.split('/'),
          //   // before: trigger.payload.before,
          // }),
          // mapper: (trigger) => ({
          //   before: trigger.payload.before,
          //   ref: trigger.payload.ref,
          //   orgRepo: trigger.payload.repository.full_name.split('/'),
          // }),
        }),
        execute: async (trigger) => {
          const { getFiles } = processPushEvent(trigger.payload as any);
          const files = await getFiles();
          const supportedTypes = ['.md', '.mdx'];
          const supportedFiles = (files ?? []).filter((file) =>
            supportedTypes.some((type) => file.filename.endsWith(type)),
          );

          const actionableFiles = await toActionableFiles(
            trigger.payload.repository.full_name,
            supportedFiles,
          );

          for (const file of actionableFiles) {
            const qb = createQueryBuilder(tables.files, 'tables').andWhere(
              'name = :name',
              { name: file.filename },
            );
            const [dbFile] = await execute(qb);

            if (file.action === 'delete') {
              if (dbFile) {
                await vectorStore.delete(process.env.OPENAI_VECTOR_STORE_ID, [
                  { id: dbFile.id },
                ]);
                await removeEntity(tables.files, qb).catch(() => {
                  // ignore errors
                });
              }
            } else {
              const [fileId] = await vectorStore.patch(
                process.env.OPENAI_VECTOR_STORE_ID,
                [
                  {
                    content: file.content,
                    filename: file.filename,
                  },
                ],
              );
              await upsertEntity(
                tables.files,
                {
                  id: fileId,
                  name: file.filename,
                },
                ['name'],
              );
            }
          }
          return {};
        },
      }),
    ],
  }),
);
