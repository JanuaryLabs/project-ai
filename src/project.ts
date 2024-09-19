import {
  feature,
  mandatory,
  policy,
  project,
  trigger,
  validation,
  ValidationDefinition,
  workflow,
} from '@january/declarative';

import { octokit, uploadToVector } from '@extensions/user';

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
    },
    tables: {},
    workflows: [
      workflow('UpsertDocFromPushRequestWorkflow', {
        tag: 'docs',
        trigger: trigger.github({
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
          mapper: (trigger) => ({
            before: trigger.payload.before,
            ref: trigger.payload.ref,
            orgRepo: trigger.payload.repository.full_name.split('/'),
          }),
        }),
        execute: async (trigger) => {
          const isMainBranch = trigger.payload.ref === 'refs/heads/main';
          if (!isMainBranch) return {};

          const [owner, repo] = trigger.payload.repository.full_name.split('/');

          const {
            data: { files },
          } = await octokit.request(
            'GET /repos/{owner}/{repo}/compare/{basehead}',
            {
              owner,
              repo,
              basehead: `${trigger.payload.before}...${trigger.payload.after}`,
            },
          );

          const supportedTypes = ['.md', '.mdx'];

          await uploadToVector(
            trigger.payload.repository.full_name,
            (files ?? []).filter((file) =>
              supportedTypes.some((type) => file.filename.endsWith(type)),
            ),
          );
          return {};
        },
      }),
    ],
  }),
);
