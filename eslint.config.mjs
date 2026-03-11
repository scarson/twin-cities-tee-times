import nextConfig from "eslint-config-next";

const eslintConfig = [
  { ignores: [".open-next/", ".next/", ".wrangler/"] },
  ...nextConfig,
];

export default eslintConfig;
