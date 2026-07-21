import coreWebVitals from "eslint-config-next/core-web-vitals";

const config = [
  ...coreWebVitals,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "deploy/**",
      "supabase/**",
      "runner/**",
    ],
  },
];

export default config;
