import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ShoppingList, { sortItems } from './shopping-list';
import type { ShoppingListItem } from '@/lib/types';

const item = (over: Partial<ShoppingListItem>): ShoppingListItem => ({
  id: Math.random().toString(), createdAt: '', updatedAt: '', name: 'x',
  qty: null, unit: null, checked: false, sourceRecipeId: null, ...over,
});

describe('sortItems', () => {
  it('puts unchecked before checked, then alphabetical', () => {
    const sorted = sortItems([
      item({ name: 'Milk', checked: true }),
      item({ name: 'Bread', checked: false }),
      item({ name: 'Apples', checked: false }),
    ]);
    expect(sorted.map((i) => i.name)).toEqual(['Apples', 'Bread', 'Milk']);
  });
});

describe('ShoppingList', () => {
  it('renders the count of items still to buy', () => {
    render(
      <ShoppingList
        items={[item({ name: 'Bread' }), item({ name: 'Milk', checked: true })]}
        onToggle={() => {}} onAdd={() => {}} onRemove={() => {}} onGenerate={() => {}}
      />,
    );
    expect(screen.getByText('1 to buy')).toBeInTheDocument();
  });
});
