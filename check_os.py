
import ast
import os

def check_imports(filepath):
    with open(filepath, "r") as f:
        try:
            tree = ast.parse(f.read())
        except Exception as e:
            print(f"Error parsing {filepath}: {e}")
            return

    imported_names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imported_names.add(alias.name.split('.')[0])
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                imported_names.add(node.module.split('.')[0])

    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and node.id == 'os':
            if 'os' not in imported_names:
                print(f"Potential missing 'os' import in {filepath} at line {node.lineno}")

print("Checking for missing os imports...")
for root, dirs, files in os.walk("api"):
    for file in files:
        if file.endswith(".py"):
            check_imports(os.path.join(root, file))
print("Check complete.")
