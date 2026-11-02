import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "@workspace/ayamai-design-system/components/ui/badge";
const meta = {
  title: "Components/Badge",
  component: Badge,
  tags: ["autodocs"],
} satisfies Meta<typeof Badge>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { args: { children: "Saved" } };
