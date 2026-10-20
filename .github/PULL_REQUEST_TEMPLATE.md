name: Pull request
description: Keep it focused — one change, one explanation.
body:
  - type: textarea
    id: what
    attributes:
      label: What changes
      description: What is different after this PR? Write it for the user, not the reviewer.
    validations:
      required: true
  - type: textarea
    id: why
    attributes:
      label: Why
      description: Which problem does this solve? Link an issue if there is one.
  - type: checkboxes
    id: checks
    attributes:
      label: Checklist
      options:
        - label: npm test passes
          required: true
        - label: npm run lint passes
          required: true
        - label: README updated if behaviour changed
          required: false
