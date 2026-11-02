import type { Meta, StoryObj } from "@storybook/react-vite";
import { Input } from "@workspace/ayamai-design-system/components/ui/input";
const meta = {
  title: "Components/Input",
  component: Input,
  tags: ["autodocs"],
} satisfies Meta<typeof Input>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {
  args: { placeholder: "Search your library", "aria-label": "Search library" },
};
