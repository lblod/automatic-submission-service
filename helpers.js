export function previousMap(collection, f) {
  let result = [];
  if (collection.length > 0)
    result.push(f(collection[0], undefined));
  for (let i = 1; i < collection.length; i++)
    result.push(f(collection[i], collection[i - 1]));
  return result;
}
