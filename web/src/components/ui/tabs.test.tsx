import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './tabs';

function Fixture({ onValueChange }: { onValueChange?: (v: string) => void }) {
  return (
    <Tabs defaultValue="recipes" onValueChange={onValueChange}>
      <TabsList>
        <TabsTrigger value="recipes">Recipes</TabsTrigger>
        <TabsTrigger value="planner">Planner</TabsTrigger>
      </TabsList>
      <TabsContent value="recipes">Recipe library</TabsContent>
      <TabsContent value="planner">Weekly planner</TabsContent>
    </Tabs>
  );
}

describe('Tabs (uncontrolled)', () => {
  it('shows the default panel and hides the others', () => {
    render(<Fixture />);
    expect(screen.getByText('Recipe library')).toBeInTheDocument();
    expect(screen.queryByText('Weekly planner')).not.toBeInTheDocument();
  });

  it('switches the visible panel when another trigger is clicked', async () => {
    const onValueChange = vi.fn();
    const user = userEvent.setup();
    render(<Fixture onValueChange={onValueChange} />);

    await user.click(screen.getByRole('button', { name: 'Planner' }));

    expect(screen.getByText('Weekly planner')).toBeInTheDocument();
    expect(screen.queryByText('Recipe library')).not.toBeInTheDocument();
    expect(onValueChange).toHaveBeenCalledWith('planner');
  });
});
