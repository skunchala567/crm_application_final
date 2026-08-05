# CRM UI Components Library

Modern, reusable component library built with React, Tailwind CSS, and shadcn/ui patterns.

## Theme Colors

- **Primary**: #3B82F6 (Power Blue)
- **Background**: #FAFBFC
- **Cards**: #FFFFFF
- **Text Primary**: #111827
- **Text Secondary**: #6B7280
- **Border**: #E5E7EB

## UI Components (`ui/`)

### Button
```jsx
import { Button } from './ui';

<Button variant="primary" size="md">Click me</Button>
// Variants: primary, secondary, ghost, danger, success, outline
// Sizes: sm, md, lg, icon
```

### Card
```jsx
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from './ui';

<Card>
  <CardHeader>
    <CardTitle>Card Title</CardTitle>
  </CardHeader>
  <CardContent>Content here</CardContent>
  <CardFooter>Footer</CardFooter>
</Card>
```

### Input
```jsx
import { Input } from './ui';

<Input type="email" placeholder="Enter email" />
```

### Label
```jsx
import { Label } from './ui';

<Label>Form Label</Label>
```

### Badge
```jsx
import { Badge } from './ui';

<Badge variant="success">Active</Badge>
// Variants: default, secondary, success, warning, danger, info, outline
```

### Select
```jsx
import { Select } from './ui';

<Select>
  <option>Option 1</option>
  <option>Option 2</option>
</Select>
```

### Avatar
```jsx
import { Avatar, AvatarImage, AvatarFallback } from './ui';

<Avatar>
  <AvatarImage src="..." />
  <AvatarFallback>JD</AvatarFallback>
</Avatar>
```

### Tabs
```jsx
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui';

<Tabs defaultValue="tab1">
  <TabsList>
    <TabsTrigger value="tab1">Tab 1</TabsTrigger>
    <TabsTrigger value="tab2">Tab 2</TabsTrigger>
  </TabsList>
  <TabsContent value="tab1">Content 1</TabsContent>
  <TabsContent value="tab2">Content 2</TabsContent>
</Tabs>
```

### Dialog
```jsx
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle } from './ui';

<Dialog>
  <DialogTrigger>Open Dialog</DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Dialog Title</DialogTitle>
    </DialogHeader>
    Dialog content here
  </DialogContent>
</Dialog>
```

### Checkbox
```jsx
import { Checkbox } from './ui';

<Checkbox checked={true} onChange={() => {}} />
```

### Textarea
```jsx
import { Textarea } from './ui';

<Textarea placeholder="Enter text..." />
```

### Alert
```jsx
import { Alert, AlertTitle, AlertDescription } from './ui';

<Alert variant="destructive">
  <AlertTitle>Error</AlertTitle>
  <AlertDescription>Something went wrong</AlertDescription>
</Alert>
// Variants: default, destructive, warning, success, info
```

### Dropdown
```jsx
import { Dropdown, DropdownTrigger, DropdownContent, DropdownItem } from './ui';

<Dropdown>
  <DropdownTrigger>Actions</DropdownTrigger>
  <DropdownContent>
    <DropdownItem onClick={() => {}}>Item 1</DropdownItem>
    <DropdownItem onClick={() => {}}>Item 2</DropdownItem>
  </DropdownContent>
</Dropdown>
```

### Skeleton
```jsx
import { Skeleton } from './ui';

<Skeleton className="h-12 w-12 rounded-lg" />
```

## Table Components

```jsx
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from './Table';

<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Header 1</TableHead>
      <TableHead>Header 2</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    <TableRow>
      <TableCell>Data 1</TableCell>
      <TableCell>Data 2</TableCell>
    </TableRow>
  </TableBody>
</Table>
```

## Layout Components

### Sidebar
Navigation sidebar with collapsible menu and settings submenu.

```jsx
import { Sidebar } from './Sidebar';

<Sidebar user={user} onLogout={handleLogout} menu={menuItems} settings={settingsItems} />
```

### Header
Sticky page header with search, breadcrumbs, and actions.

```jsx
import { Header } from './Header';

<Header
  title="Page Title"
  subtitle="Page subtitle"
  breadcrumbs={[...]}
  actions={[...]}
/>
```

### AuthLayout
Full-screen authentication layout with brand section.

```jsx
import { AuthLayout } from './AuthLayout';

<AuthLayout>
  {/* Login form goes here */}
</AuthLayout>
```

### PageContainer
Consistent page content wrapper with max-width and padding.

```jsx
import { PageContainer } from './PageContainer';

<PageContainer variant="default">
  Page content here
</PageContainer>
```

## Specialized Components

### StatCard
Dashboard stat card with icon, value, and trend.

```jsx
import { StatCard } from './StatCard';

<StatCard
  label="Total Leads"
  value={1234}
  trend="+12% vs last month"
  icon={UsersIcon}
  color="blue"
/>
```

### StatusBadge
Lead stage status indicator.

```jsx
import { StatusBadge } from './StatusBadge';

<StatusBadge stage="application" />
// Automatically selects appropriate color based on stage
```

### EmptyState
Display when no data is available.

```jsx
import { EmptyState } from './EmptyState';

<EmptyState
  icon={EmptyIcon}
  title="No leads found"
  description="Start by adding a new lead"
  action={{ label: 'Add Lead', onClick: () => {} }}
/>
```

### Divider
Section separator with optional text.

```jsx
import { Divider } from './Divider';

<Divider />
<Divider variant="with-text">Or continue with</Divider>
```

## Utility Functions

### cn() - Class Name Merger
Combines classNames using clsx and tailwind-merge.

```jsx
import { cn } from '../lib/utils';

const className = cn(
  'px-4 py-2 rounded',
  isActive && 'bg-primary-600 text-white'
);
```

## Design Principles

1. **Consistency**: All components follow the same design language
2. **Accessibility**: Built-in ARIA labels and keyboard support
3. **Responsive**: Works on mobile, tablet, and desktop
4. **Composable**: Components can be combined for complex UIs
5. **Dark Mode Ready**: All colors use CSS custom properties for easy theming

## Migration Notes

When refactoring existing components:
1. Replace old style classes with Tailwind equivalents
2. Use UI components instead of custom HTML elements
3. Maintain existing props and behavior for compatibility
4. Update component documentation as needed
