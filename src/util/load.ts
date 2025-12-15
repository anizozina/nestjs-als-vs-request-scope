export const load = () => {
  // Simulate minimal computation (avoid I/O)
  for (let i = 0; i < 100; i++) {
    Math.sqrt(i);
  }
};
