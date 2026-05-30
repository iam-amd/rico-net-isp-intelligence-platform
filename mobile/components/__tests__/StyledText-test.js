import * as React from 'react';
import renderer, { act } from 'react-test-renderer';

import LoadingScreen from '../LoadingScreen';

it(`renders the loading screen`, () => {
  let tree;

  act(() => {
    tree = renderer.create(<LoadingScreen message="Snapshot test!" />);
  });

  expect(tree.toJSON()).toBeTruthy();
});
