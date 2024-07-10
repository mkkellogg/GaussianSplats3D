module.exports = {
    'env': {
      'browser': true,
      'es2021': true,
    },
    'extends': 'google',
    'overrides': [
      {
        'env': {
          'node': true,
        },
        'files': [
          '.eslintrc.{js,cjs}',
        ],
        'parserOptions': {
          'sourceType': 'script',
        },
      },
    ],
    'parserOptions': {
      'ecmaVersion': 'latest',
      'sourceType': 'module',
    },
    'rules': {
      "indent": ["error", 4],
      "max-len": ["error", 140],
      "object-curly-spacing": ["off"],
      "comma-dangle": ["off"],
      "prefer-const": ["off"],
      'require-jsdoc': ["off"],
      "padded-blocks": ["off"],
      "indent": ["off"],
      "arrow-parens": ["off"],
      "no-unused-vars": ["error"],
      "valid-jsdoc" : ["off"]
    },
  };
  