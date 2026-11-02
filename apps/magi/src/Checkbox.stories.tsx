import type { Meta, StoryObj } from "@storybook/react-vite";
import { Checkbox } from "@workspace/ayamai-design-system/components/ui/checkbox";
const meta = {
  title: "Components/Checkbox",
  component: Checkbox,
  tags: ["autodocs"],
} satisfies Meta<typeof Checkbox>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { args: { "aria-label": "Select media" } };
