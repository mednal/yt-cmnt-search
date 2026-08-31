/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  rootDir: 'src',
  testEnvironment: 'node',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.spec.json' }],
  },
};
