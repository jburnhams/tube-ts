import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import App from '../App';

// Setup testing library if needed, but simple render is fine
// Need to install @testing-library/react and @testing-library/dom in docs devDependencies?
// I only installed react, react-dom. Testing library is standard for React testing.
// I will check if I can run without it or if I should install it.
// Given the requirements "best practices", I should install testing-library.

describe('App', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders title', () => {
    render(<App />);
    expect(screen.getByText('My Library Docs')).toBeTruthy();
  });

  it('updates greeting when button is clicked', () => {
    render(<App />);
    const button = screen.getByText('Greet');
    fireEvent.click(button);
    expect(screen.getByTestId('greeting-result').textContent).toBe('Hello, World!');
  });
});
