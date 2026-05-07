/* eslint-disable camelcase */

// Persist the original Q-number marker bbox (in source PDF points) on
// each question. The PDF composer uses it to paint a white rectangle
// over the original number on each clip and draw the new running
// number in its place — single-number export PDFs.

exports.up = (pgm) => {
  pgm.addColumn('questions', {
    marker_bbox: { type: 'jsonb' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('questions', 'marker_bbox');
};
