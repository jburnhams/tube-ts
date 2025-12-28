import { describe, it, expect } from 'vitest';
import { hello, goodbye, Greeter } from '../../src/index.js';

describe('hello function', () => {
  it('should return default greeting', () => {
    const result = hello();
    expect(result).toBe('Hello, World!');
  });

  it('should greet a specific person', () => {
    const result = hello('Alice');
    expect(result).toBe('Hello, Alice!');
  });
});

describe('goodbye function', () => {
  it('should return default goodbye', () => {
    const result = goodbye();
    expect(result).toBe('Goodbye, World!');
  });

  it('should say goodbye to a specific person', () => {
    const result = goodbye('Bob');
    expect(result).toBe('Goodbye, Bob!');
  });
});

describe('Greeter class', () => {
  it('should greet with the configured name', () => {
    const greeter = new Greeter('Charlie');
    const result = greeter.greet();
    expect(result).toBe('Hello, Charlie!');
  });

  it('should say farewell with the configured name', () => {
    const greeter = new Greeter('Diana');
    const result = greeter.farewell();
    expect(result).toBe('Goodbye, Diana!');
  });

  it('should handle multiple instances independently', () => {
    const greeter1 = new Greeter('Eve');
    const greeter2 = new Greeter('Frank');

    expect(greeter1.greet()).toBe('Hello, Eve!');
    expect(greeter2.greet()).toBe('Hello, Frank!');
  });
});
