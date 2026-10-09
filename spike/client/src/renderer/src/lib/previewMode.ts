/** True only for `vite --mode preview` (npm run preview / the static preview build). */
export const isPreview = import.meta.env.MODE === 'preview';
