import type { Meta, StoryObj } from "@storybook/react-vite";
import { Progress } from "@workspace/ayamai-design-system/components/ui/progress";
const meta = {
  title: "Components/Progress",
  component: Progress,
  tags: ["autodocs"],
} satisfies Meta<typeof Progress>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {
  args: { value: 65, "aria-label": "Import progress", className: "max-w-sm" },
};
