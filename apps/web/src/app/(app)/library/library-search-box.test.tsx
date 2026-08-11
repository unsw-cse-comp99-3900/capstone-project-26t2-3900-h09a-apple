/** @vitest-environment jsdom */
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { LibrarySearchBox } from './library-search-box';

function SearchHarness() {
  const [value, setValue] = useState('');
  return <LibrarySearchBox value={value} onChange={setValue} />;
}

describe('LibrarySearchBox', () => {
  it('updates the search field when the user types', async () => {
    const user = userEvent.setup();
    render(<SearchHarness />);

    const input = screen.getByLabelText('Find a procedure');
    await user.type(input, 'onboarding');

    expect(input).toHaveValue('onboarding');
  });
});
