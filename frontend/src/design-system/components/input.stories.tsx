import type { Meta, StoryObj } from '@storybook/react-vite'
import { IconCalendar, IconSearch, IconX } from '@tabler/icons-react'
import { Button } from './button'
import { Field, FieldDescription, FieldError, FieldLabel } from './field'
import { Input, Textarea } from './input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from './input-group'
import { Frame, Row } from '../story-helpers'

const meta = {
  title: 'Components/Input',
  component: Input,
  args: { placeholder: 'TATAMOTORS' },
  argTypes: {
    numeric: { control: 'boolean' },
    disabled: { control: 'boolean' },
    'aria-invalid': { control: 'boolean' },
  },
} satisfies Meta<typeof Input>
export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = { render: (a) => <Input className="w-64" {...a} /> }

export const States: Story = {
  render: () => (
    <div className="max-w-xl">
      <Row label="Default">
        <Input className="w-56" placeholder="Symbol" />
      </Row>
      <Row label="Numeric">
        <Input numeric className="w-32 text-right" defaultValue="986.25" />
      </Row>
      <Row label="Invalid">
        <Input numeric className="w-32" aria-invalid defaultValue="1,002.00" />
      </Row>
      <Row label="Disabled">
        <Input className="w-56" disabled defaultValue="Locked" />
      </Row>
      <Row label="Textarea">
        <Textarea
          className="w-80"
          defaultValue="Waited for the close above pivot instead of buying intraday."
        />
      </Row>
    </div>
  ),
}

export const InputGroups: Story = {
  name: 'Input group',
  render: () => (
    <div className="max-w-xl">
      <Row label="Search">
        <InputGroup className="w-64">
          <InputGroupAddon>
            <IconSearch />
          </InputGroupAddon>
          <InputGroupInput placeholder="Search stocks, pages…" />
          <InputGroupAddon align="inline-end">
            <InputGroupButton aria-label="Clear">
              <IconX />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </Row>
      <Row label="Prefix + suffix">
        <InputGroup className="w-64">
          <InputGroupAddon>
            <InputGroupText>₹</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput numeric defaultValue="2,500" />
          <InputGroupAddon align="inline-end">
            <InputGroupText>1.0% of equity</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
      </Row>
      <Row label="Date">
        <InputGroup className="w-44">
          <InputGroupAddon>
            <IconCalendar />
          </InputGroupAddon>
          <InputGroupInput numeric defaultValue="24-11-2026" />
        </InputGroup>
      </Row>
      <Row label="Textarea">
        <InputGroup className="w-96">
          <InputGroupTextarea rows={2} placeholder="Ask about your book…" />
          <InputGroupAddon align="block-end" className="justify-between">
            <InputGroupText>@positions</InputGroupText>
            <Button size="xs">Send</Button>
          </InputGroupAddon>
        </InputGroup>
      </Row>
    </div>
  ),
}

/** Field wires label, description and error to the control for screen readers. */
export const Fields: Story = {
  name: 'Field (label · help · error)',
  render: () => (
    <Frame title="Order" className="w-80">
      <div className="grid grid-cols-2 gap-2">
        <Field>
          <FieldLabel>Qty</FieldLabel>
          <Input numeric defaultValue="52" />
        </Field>
        <Field>
          <FieldLabel>Price</FieldLabel>
          <Input numeric defaultValue="986.25" />
        </Field>
        <Field invalid>
          <FieldLabel>Stop loss</FieldLabel>
          <Input numeric defaultValue="1,002.00" aria-invalid />
          <FieldError match>Above entry for a long</FieldError>
        </Field>
        <Field>
          <FieldLabel>Target</FieldLabel>
          <Input numeric defaultValue="1,062.00" />
          <FieldDescription>R:R 1 : 2.4</FieldDescription>
        </Field>
      </div>
    </Frame>
  ),
}
