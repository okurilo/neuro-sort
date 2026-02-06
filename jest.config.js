module.exports = {
    preset: "ts-jest",
    testEnvironment: "jsdom",
    roots: ["<rootDir>/__tests__"],
    testMatch: ["**/__tests__/**/*.test.ts"],
    transform: {
        "^.+\\.(ts|tsx)$": [
            "ts-jest",
            { tsconfig: "tsconfig.json", diagnostics: false, isolatedModules: true },
        ],
    },
    moduleNameMapper: {
        "^usehooks-ts$": "<rootDir>/__tests__/__mocks__/usehooks-ts.js",
        ".*/helpers/normalizeSize$": "<rootDir>/__tests__/__mocks__/normalizeSize.js",
        ".*/stores/widgets-show$": "<rootDir>/__tests__/__mocks__/widgets-show.js",
        "^\\.\\./\\.\\./types$": "<rootDir>/__tests__/__mocks__/types.js",
        "^\\.\\./\\.\\./\\.\\./\\.\\./types$": "<rootDir>/__tests__/__mocks__/types.js"
    }
};
