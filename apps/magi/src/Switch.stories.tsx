import type { Meta, StoryObj } from "@storybook/react-vite";
import { Switch } from "@workspace/ayamai-design-system/components/ui/switch";
const meta = {
  title: "Components/Switch",
  component: Switch,
  tags: ["autodocs"],
} satisfies Meta<typeof Switch>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { args: { "aria-label": "Show saved only" } };
