import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";
const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: ["../src/**/*.stories.tsx"],
  addons: ["@storybook/addon-docs"],
  staticDirs: [
    {
      from: "../../../artifacts/private-media-library/public/brand",
      to: "/brand",
    },
  ],
  core: { disableTelemetry: true },
  viteFinal: async (config) => ({
    ...config,
    esbuild: { ...config.esbuild, jsx: "automatic" },
    plugins: [...(config.plugins ?? []), tailwindcss()],
  }),
};
export default config;
