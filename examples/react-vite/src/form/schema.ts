import * as v from 'valibot';

export const ProfileSchema = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(2, 'Name must be at least 2 characters')),
  email: v.pipe(v.string(), v.email('Please enter a valid email')),
  role: v.picklist(['developer', 'designer', 'manager'], 'Please pick a role'),
  newsletter: v.boolean(),
  notifications: v.object({
    email: v.boolean(),
    push: v.boolean(),
    weeklyDigest: v.boolean(),
  }),
  skills: v.array(
    v.object({
      label: v.pipe(v.string(), v.minLength(1, 'Skill cannot be empty')),
    }),
  ),
  guests: v.array(
    v.object({
      name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Guest name cannot be empty')),
      coming: v.boolean(),
    }),
  ),
});

export type ProfileInput = v.InferInput<typeof ProfileSchema>;
export type ProfileOutput = v.InferOutput<typeof ProfileSchema>;

export const defaultProfile: ProfileInput = {
  name: '',
  email: '',
  role: 'developer',
  newsletter: false,
  notifications: { email: true, push: false, weeklyDigest: false },
  skills: [{ label: 'TypeScript' }, { label: 'React' }],
  guests: [
    { name: 'Ada', coming: true },
    { name: 'Grace', coming: false },
  ],
};
