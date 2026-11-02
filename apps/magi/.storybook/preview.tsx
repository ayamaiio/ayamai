import type { Preview } from "@storybook/react-vite";
import "../src/styles.css";
const preview: Preview = {
  globalTypes: {
    theme: {
      description: "Existing product theme",
      toolbar: { icon: "paintbrush", items: ["dark", "light"] },
    },
  },
  initialGlobals: { theme: "dark" },
  decorators: [
    (Story, context) => {
      document.documentElement.classList.toggle(
        "dark",
        context.globals.theme === "dark",
      );
      return (
        <main style={{ padding: 0, minHeight: "100vh" }}>
          <Story />
        </main>
      );
    },
  ],
  parameters: {
    layout: "fullscreen",
    viewport: {
      options: {
        mobile: {
          name: "Mobile · 390",
          styles: { width: "390px", height: "844px" },
          type: "mobile",
        },
        tablet: {
          name: "Tablet · 768",
          styles: { width: "768px", height: "1024px" },
          type: "tablet",
        },
        desktop: {
          name: "Desktop · 1440",
          styles: { width: "1440px", height: "1000px" },
          type: "desktop",
        },
      },
    },
    controls: { expanded: true },
    options: {
      storySort: {
        order: [
          "MAGI",
          "Typography playground",
          "Foundations",
          "Compositions",
          "Components",
        ],
      },
    },
  },
};
export default preview;
