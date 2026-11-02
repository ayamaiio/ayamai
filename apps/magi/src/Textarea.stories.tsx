import type { Meta, StoryObj } from "@storybook/react-vite";
import { Textarea } from "@workspace/ayamai-design-system/components/ui/textarea";
const meta = {
  title: "Components/Textarea",
  component: Textarea,
  tags: ["autodocs"],
} satisfies Meta<typeof Textarea>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {
  args: { placeholder: "Add a note", "aria-label": "Media note" },
};
