/**
 * Built-in learning library — a progressive set of Python snippets that the
 * student can step through to grow their understanding of the semantic
 * world. Each entry pairs a tiny program with a plain-language explanation.
 */

export interface Example {
  id: string
  title: string
  level: number
  description: string
  code: string
}

export const FACTORIAL_EXAMPLE = `def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)

result = factorial(5)
print(result)
`

export const EXAMPLES: Example[] = [
  {
    id: 'hello-world',
    title: '01 · Hello World',
    level: 1,
    description: 'A single statement. The simplest possible program.',
    code: `print("Hello, semantic world!")\n`,
  },
  {
    id: 'variables',
    title: '02 · Variables',
    level: 1,
    description: 'Boxes that hold values. Watch them flash as the value changes.',
    code: `x = 10
y = x + 5
z = y * 2
print(z)
`,
  },
  {
    id: 'conditions',
    title: '03 · Conditions',
    level: 2,
    description: 'A diamond chooses YES or NO based on a test.',
    code: `age = 18

if age >= 18:
    status = "adult"
else:
    status = "minor"

print(status)
`,
  },
  {
    id: 'loops',
    title: '04 · Loops',
    level: 2,
    description: 'A ring that runs its body N times. The badge shows how many.',
    code: `total = 0
for i in range(5):
    total = total + i
print(total)
`,
  },
  {
    id: 'functions',
    title: '05 · Functions',
    level: 3,
    description: 'A reusable hex chamber. Calls flow in, returns flow back.',
    code: `def square(n):
    return n * n

a = square(3)
b = square(7)
print(a + b)
`,
  },
  {
    id: 'nested-loops',
    title: '06 · Nested Loops',
    level: 3,
    description: 'A loop inside a loop. Watch the inner ring run for every outer step.',
    code: `for i in range(3):
    for j in range(3):
        print(i, j)
`,
  },
  {
    id: 'recursion',
    title: '07 · Recursion',
    level: 4,
    description: 'A function that calls itself. Crimson icosahedron means recursion.',
    code: FACTORIAL_EXAMPLE,
  },
  {
    id: 'sorting',
    title: '08 · Sorting (bubble)',
    level: 4,
    description: 'A loop, a nested loop, a condition, a swap. Watch the data settle.',
    code: `def bubble_sort(arr):
    n = len(arr)
    for i in range(n):
        for j in range(n - i - 1):
            if arr[j] > arr[j + 1]:
                arr[j], arr[j + 1] = arr[j + 1], arr[j]
    return arr

result = bubble_sort([5, 2, 8, 1, 9, 3])
print(result)
`,
  },
  {
    id: 'tree',
    title: '09 · Tree Walk',
    level: 5,
    description: 'Recursion over a tree-like structure. Function calls itself for each child.',
    code: `def walk(node, depth):
    if node is None:
        return 0
    left = walk(node.get("l"), depth + 1)
    right = walk(node.get("r"), depth + 1)
    return 1 + left + right

tree = {
    "v": 1,
    "l": {"v": 2, "l": None, "r": None},
    "r": {"v": 3, "l": {"v": 4, "l": None, "r": None}, "r": None},
}

count = walk(tree, 0)
print(count)
`,
  },
  {
    id: 'graph',
    title: '10 · Graph BFS',
    level: 5,
    description: 'A queue-driven traversal. Loop drives the search; condition gates visited nodes.',
    code: `def bfs(graph, start):
    visited = set()
    order = []
    queue = [start]
    while queue:
        node = queue.pop(0)
        if node in visited:
            continue
        visited.add(node)
        order.append(node)
        for neighbour in graph.get(node, []):
            queue.append(neighbour)
    return order

graph = {
    "A": ["B", "C"],
    "B": ["D"],
    "C": ["D", "E"],
    "D": ["F"],
    "E": ["F"],
    "F": [],
}

print(bfs(graph, "A"))
`,
  },
]
